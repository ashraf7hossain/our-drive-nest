import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

@Entity()
export class File {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: "private" })
  visibility: "private" | "public";

  @Column()
  fileName: string;

  @Column()
  filePath: string;

  @Column()
  fileType: string;

  @Column()
  fileSize: number;

  @ManyToOne(() => User, (user) => user.files , { onDelete: 'CASCADE' })
  user: User;
}