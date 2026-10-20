import { createHash, randomBytes } from 'crypto';
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ForeignKeyConstraintError } from 'sequelize';
import { HomeService } from '../home/home.service';
import { Device, type DeviceStatus } from './models/device.model';

export type DevicePublicDto = {
  id: number;
  name: string;
  tokenPrefix: string;
  firmwareVersion: string | null;
  status: DeviceStatus;
  online: boolean;
  cameraOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Persistencia y autenticación de dispositivos Jarvis.
 */
@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device)
    private readonly deviceModel: typeof Device,
    private readonly homeService: HomeService,
  ) {}

  /** Lista todos los dispositivos (estado de DB; `online` lo enriquece el registry). */
  async list(): Promise<Device[]> {
    // Los archivados (borrados con historial) ya no se muestran.
    return this.deviceModel.findAll({ where: { active: true }, order: [['id', 'ASC']] });
  }

  async findById(id: number): Promise<Device> {
    const device = await this.deviceModel.findByPk(id);
    if (!device) {
      throw new NotFoundException(`Device ${id} not found`);
    }
    return device;
  }

  /**
   * Crea un dispositivo y devuelve el token en claro una sola vez.
   *
   * @param name Nombre legible (ej. "Jarvis Paperwhite").
   */
  async create(name: string): Promise<{ device: Device; token: string }> {
    const token = this.generateToken();
    const device = await this.deviceModel.create({
      name: name.trim() || 'Jarvis Device',
      tokenHash: this.hashToken(token),
      tokenPrefix: token.slice(0, 8),
      status: 'offline',
      firmwareVersion: null,
      lastSeenAt: null,
    });
    // Botón, cámara, mic, contacto de puerta y bocina para registrar eventos.
    await this.homeService.ensureDeviceDefaults(device.id);
    return { device, token };
  }

  /**
   * Rota el token de autenticación WS. El valor anterior deja de funcionar.
   *
   * @param id Identificador del dispositivo.
   */
  async rotateToken(id: number): Promise<{ device: Device; token: string }> {
    const device = await this.findById(id);
    const token = this.generateToken();
    device.tokenHash = this.hashToken(token);
    device.tokenPrefix = token.slice(0, 8);
    await device.save();
    return { device, token };
  }

  /**
   * Borra el dispositivo; si ya tiene historial de visitas (la BD lo protege
   * con RESTRICT) se **archiva**: deja de mostrarse y de poder conectarse,
   * pero sus visitas se conservan.
   *
   * @returns `archived` cuando no se pudo borrar por el historial.
   */
  async delete(id: number): Promise<{ archived: boolean }> {
    const device = await this.findById(id);
    try {
      await device.destroy();
      return { archived: false };
    } catch (error) {
      if (!(error instanceof ForeignKeyConstraintError)) {
        throw error;
      }
      device.active = false;
      device.status = 'offline';
      // Token inservible: el hash de un valor aleatorio que nadie conoce.
      device.tokenHash = this.hashToken(randomBytes(32).toString('hex'));
      await device.save();
      return { archived: true };
    }
  }

  /**
   * Resuelve un token Bearer al dispositivo correspondiente.
   *
   * @param token Token en claro enviado por el ESP32.
   */
  async authenticate(token: string): Promise<Device | null> {
    if (!token?.trim()) {
      return null;
    }
    const hash = this.hashToken(token.trim());
    return this.deviceModel.findOne({ where: { tokenHash: hash, active: true } });
  }

  async markStatus(
    id: number,
    status: DeviceStatus,
    extras?: { firmwareVersion?: string },
  ): Promise<Device> {
    const device = await this.findById(id);
    device.status = status;
    device.lastSeenAt = new Date();
    if (extras?.firmwareVersion) {
      device.firmwareVersion = extras.firmwareVersion;
    }
    await device.save();
    return device;
  }

  toPublicDto(
    device: Device,
    online: boolean,
    cameraOnline = false,
  ): DevicePublicDto {
    return {
      id: device.id,
      name: device.name,
      tokenPrefix: device.tokenPrefix,
      firmwareVersion: device.firmwareVersion,
      status: online ? device.status : 'offline',
      online,
      cameraOnline,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private generateToken(): string {
    return `jdv_${randomBytes(24).toString('base64url')}`;
  }
}
