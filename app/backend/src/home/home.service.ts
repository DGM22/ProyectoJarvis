import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Actuator } from './models/actuator.model';
import { Sensor, type SensorName } from './models/sensor.model';

/** Sensores que trae cada dispositivo de puerta (el contacto, para después). */
const DEFAULT_SENSORS: ReadonlyArray<[SensorName, string]> = [
  ['doorbell_button', 'Botón del timbre'],
  ['camera', 'Cámara de la puerta'],
  ['microphone', 'Micrófono INMP441'],
  ['door_contact', 'Sensor magnético de la puerta (pendiente de instalar)'],
];

/**
 * Inventario físico de la casa (sensores y actuadores por dispositivo). Base
 * para registrar interacciones, lecturas y activaciones.
 */
@Injectable()
export class HomeService {
  constructor(
    @InjectModel(Sensor) private readonly sensorModel: typeof Sensor,
    @InjectModel(Actuator) private readonly actuatorModel: typeof Actuator,
  ) {}

  /** Crea los sensores y la bocina por defecto de un dispositivo (idempotente). */
  async ensureDeviceDefaults(deviceId: number): Promise<void> {
    for (const [name, description] of DEFAULT_SENSORS) {
      await this.sensorModel.findOrCreate({
        where: { deviceId, name },
        defaults: { deviceId, name, description },
      });
    }
    const microphone = await this.findSensor(deviceId, 'microphone');
    await this.actuatorModel.findOrCreate({
      where: { deviceId, type: 'speaker' },
      defaults: { deviceId, type: 'speaker', pairedSensorId: microphone?.id ?? null },
    });
  }

  findSensor(deviceId: number, name: SensorName): Promise<Sensor | null> {
    return this.sensorModel.findOne({ where: { deviceId, name } });
  }
}
