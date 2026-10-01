import { createHash, randomBytes } from 'crypto';
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
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
  ) {}

  /** Lista todos los dispositivos (estado de DB; `online` lo enriquece el registry). */
  async list(): Promise<Device[]> {
    return this.deviceModel.findAll({ order: [['id', 'ASC']] });
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

  async delete(id: number): Promise<void> {
    const device = await this.findById(id);
    await device.destroy();
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
    return this.deviceModel.findOne({ where: { tokenHash: hash } });
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
