import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CameraHubService } from './camera-hub.service';
import { DevicesGateway } from './devices.gateway';
import { DevicesRegistryService } from './devices-registry.service';
import { DevicesService } from './devices.service';

type CreateDeviceBody = {
  name?: string;
};

type CallDeviceBody = {
  prompt?: string;
  voice?: string;
};

/**
 * API HTTP para aprovisionar dispositivos y disparar llamadas inbound
 * (panel Config / futuro motor de alertas de sensores).
 */
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly registry: DevicesRegistryService,
    private readonly devicesGateway: DevicesGateway,
    private readonly cameraHub: CameraHubService,
  ) {}

  /** Lista dispositivos con flag `online` en tiempo real. */
  @Get()
  async list() {
    const devices = await this.devicesService.list();
    return devices.map((device) =>
      this.devicesService.toPublicDto(
        device,
        this.registry.isOnline(device.id),
        this.cameraHub.isCameraOnline(device.id),
      ),
    );
  }

  /** Crea un dispositivo y devuelve el token en claro una sola vez. */
  @Post()
  async create(@Body() body: CreateDeviceBody) {
    const name = body.name?.trim() || 'Jarvis Device';
    const { device, token } = await this.devicesService.create(name);
    return {
      ...this.devicesService.toPublicDto(device, false),
      token,
    };
  }

  @Get(':id')
  async getOne(@Param('id', ParseIntPipe) id: number) {
    const device = await this.devicesService.findById(id);
    return this.devicesService.toPublicDto(
      device,
      this.registry.isOnline(device.id),
      this.cameraHub.isCameraOnline(device.id),
    );
  }

  /** Rota el token WS; el anterior deja de autenticar. */
  @Post(':id/rotate-token')
  async rotateToken(@Param('id', ParseIntPipe) id: number) {
    const { device, token } = await this.devicesService.rotateToken(id);
    return {
      ...this.devicesService.toPublicDto(
        device,
        this.registry.isOnline(device.id),
      ),
      token,
    };
  }

  /**
   * Llama al dispositivo online: Jarvis contesta con voz en el ESP32.
   * Es el mismo gancho que usarán alertas de sensores más adelante.
   */
  @Post(':id/call')
  async call(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CallDeviceBody,
  ) {
    const device = await this.devicesService.findById(id);
    if (!this.registry.isOnline(device.id)) {
      throw new ServiceUnavailableException(
        'Device is offline; power it on and wait for WS hello',
      );
    }

    const prompt =
      body.prompt?.trim() ||
      'El usuario te está llamando desde la app web de Jarvis. Salúdalo brevemente en español y pregunta en qué puedes ayudar.';

    const started = await this.devicesGateway.startInboundCall(
      device.id,
      prompt,
      body.voice,
    );
    if (!started) {
      throw new ServiceUnavailableException('Could not reach device socket');
    }

    return {
      ok: true,
      deviceId: device.id,
      message: 'Inbound call started',
    };
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.devicesService.findById(id);
    const live = this.registry.get(id);
    if (live) {
      try {
        live.socket.close(4001, 'deleted');
      } catch {
        // ignore
      }
    }
    await this.devicesService.delete(id);
    return { ok: true };
  }
}
