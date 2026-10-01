import {
  AutoIncrement,
  Column,
  CreatedAt,
  DataType,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { TranscriptSegment } from './transcript-segment.model';

export type TranscriptStatus = 'recording' | 'completed' | 'failed';

/**
 * Sesión de transcripción de una junta.
 *
 * El texto completo se reconstruye concatenando `segments` ordenados por
 * `sequenceNumber`. El archivo `.txt` en disco es un caché de esa concatenación.
 */
@Table({
  tableName: 'transcripts',
  underscored: true,
})
export class Transcript extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.INTEGER })
  declare id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  declare title: string;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'recording' })
  declare status: TranscriptStatus;

  @Column({ type: DataType.STRING, allowNull: true })
  declare filePath: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare durationSeconds: number | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare startedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare endedAt: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @HasMany(() => TranscriptSegment)
  declare segments?: TranscriptSegment[];
}
