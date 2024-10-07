import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { File } from "./File";
@Entity({ name: "users" })
export class User{
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  userType: string;

  @Column({ default: new Date() })
  createdAt: Date;

  @Column({ default: new Date() })
  updatedAt: Date;

  @OneToMany(() => File, (file) => file.user)
  files: File[]

}