import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { randomBytes } from 'crypto';
import type { IncomingMessage } from 'http';
import { Sequelize } from 'sequelize-typescript';
import {
  HouseholdMember,
  type HouseholdRole,
} from '../household/models/household-member.model';
import { User } from './models/user.model';
import {
  hashPassword,
  readCookie,
  signSession,
  verifyPassword,
  verifySession,
} from './session-token';

export const SESSION_COOKIE = 'jarvis_session';

export interface AuthUser {
  id: number;
  username: string;
  personId: number;
  name: string;
  role: HouseholdRole;
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,50}$/;
const MIN_PASSWORD_LENGTH = 8;
/** Intentos fallidos permitidos por IP antes de bloquear un rato. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60_000;

/**
 * Cuentas de la app: alta del primer dueño, login con usuario y contraseña, y
 * validación de la cookie de sesión (HTTP y WebSockets del navegador).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string;
  private readonly sessionMs: number;
  private readonly failedLogins = new Map<string, { count: number; until: number }>();

  constructor(
    configService: ConfigService,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(HouseholdMember) private readonly personModel: typeof HouseholdMember,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {
    const configured = configService.get<string>('auth.secret');
    if (!configured) {
      this.logger.warn(
        'AUTH_SECRET no está configurado: las sesiones se cierran cada vez que reinicia el backend.',
      );
    }
    this.secret = configured || randomBytes(32).toString('hex');
    this.sessionMs = (configService.get<number>('auth.sessionDays') ?? 30) * 24 * 3600_000;
  }

  get sessionMaxAgeMs(): number {
    return this.sessionMs;
  }

  async hasUsers(): Promise<boolean> {
    return (await this.userModel.count()) > 0;
  }

  /**
   * Crea la cuenta del primer dueño. Solo funciona mientras no exista ninguna
   * cuenta; si ya hay una persona con rol `owner` sin cuenta, se le liga.
   */
  async setupOwner(input: { name: string; username: string; password: string }): Promise<User> {
    const username = this.normalizeUsername(input.username);
    this.assertPassword(input.password);

    return this.sequelize.transaction(async (transaction) => {
      if ((await this.userModel.count({ transaction })) > 0) {
        throw new ForbiddenException('La cuenta del dueño ya existe; inicia sesión.');
      }
      let person = await this.personModel.findOne({
        where: { role: 'owner' },
        order: [['id', 'ASC']],
        transaction,
      });
      if (!person) {
        const name = input.name?.trim();
        if (!name) throw new BadRequestException('Escribe tu nombre');
        person = await this.personModel.create({ name, role: 'owner' }, { transaction });
      }
      const { hash, salt } = await hashPassword(input.password);
      return this.userModel.create(
        { personId: person.id, username, passwordHash: hash, salt },
        { transaction },
      );
    });
  }

  /** Alta de una cuenta para otra persona de la casa (solo el dueño). */
  async createUser(input: {
    personId: number;
    username: string;
    password: string;
  }): Promise<User> {
    const username = this.normalizeUsername(input.username);
    this.assertPassword(input.password);
    const person = await this.personModel.findByPk(input.personId);
    if (!person) throw new BadRequestException('Esa persona no existe');
    if (await this.userModel.findOne({ where: { username } })) {
      throw new ConflictException('Ese usuario ya existe');
    }
    const { hash, salt } = await hashPassword(input.password);
    return this.userModel.create({ personId: person.id, username, passwordHash: hash, salt });
  }

  async listUsers(): Promise<AuthUser[]> {
    const users = await this.userModel.findAll({
      include: [HouseholdMember],
      order: [['id', 'ASC']],
    });
    return users.map((user) => this.toAuthUser(user));
  }

  /** @returns el token de sesión para la cookie. */
  async login(username: string, password: string, ip: string): Promise<{ token: string; user: AuthUser }> {
    this.assertNotLocked(ip);
    const user = await this.userModel.findOne({
      where: { username: (username ?? '').trim().toLowerCase() },
      include: [HouseholdMember],
    });
    const ok =
      user !== null &&
      user.person?.active !== false &&
      (await verifyPassword(password ?? '', user.salt, user.passwordHash));
    if (!ok || !user) {
      this.registerFailure(ip);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    this.failedLogins.delete(ip);
    await user.update({ lastLoginAt: new Date() });
    const token = signSession({ uid: user.id, exp: Date.now() + this.sessionMs }, this.secret);
    return { token, user: this.toAuthUser(user) };
  }

  async userFromToken(token: string | undefined): Promise<AuthUser | null> {
    const payload = verifySession(token, this.secret);
    if (!payload) return null;
    const user = await this.userModel.findByPk(payload.uid, { include: [HouseholdMember] });
    if (!user || user.person?.active === false) return null;
    return this.toAuthUser(user);
  }

  /** Para WebSockets: la cookie viaja en el upgrade del mismo dominio. */
  userFromRequest(req: IncomingMessage): Promise<AuthUser | null> {
    return this.userFromToken(readCookie(req.headers.cookie, SESSION_COOKIE));
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      username: user.username,
      personId: user.personId,
      name: user.person?.name ?? user.username,
      role: user.person?.role ?? 'resident',
    };
  }

  private normalizeUsername(raw: string): string {
    const username = (raw ?? '').trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw new BadRequestException(
        'El usuario debe tener 3 a 50 caracteres: letras, números, punto, guion o guion bajo',
      );
    }
    return username;
  }

  private assertPassword(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }
  }

  private assertNotLocked(ip: string): void {
    const entry = this.failedLogins.get(ip);
    if (entry && entry.count >= MAX_FAILED_LOGINS && entry.until > Date.now()) {
      throw new HttpException('Demasiados intentos. Espera unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private registerFailure(ip: string): void {
    const now = Date.now();
    const entry = this.failedLogins.get(ip);
    const count = entry && entry.until > now ? entry.count + 1 : 1;
    this.failedLogins.set(ip, { count, until: now + LOCKOUT_MS });
  }
}
