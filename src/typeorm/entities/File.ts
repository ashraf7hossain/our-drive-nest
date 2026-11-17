import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class File {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", nullable: true, unique: true })
  uploadId: string;

  @Column({ default: "private" })
  visibility: "private" | "public";

  @Column()
  fileName: string;

  @Column()
  filePath: string;

  @Column()
  fileType: string;

  @Column({ type: "bigint" })
  fileSize: number;

  @ManyToOne(() => User, (user) => user.files , { onDelete: 'CASCADE' })
  user: User;
}