// Utility
import * as bcrypt from 'bcrypt';
import { Injectable } from '@nestjs/common';
// Services
import { DatabaseService } from 'src/database/database.service';
// Types
import { RegisterDto } from 'src/auth/dto/auth.dto';
import { UserWithoutPassword } from './types/user.type';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async findByEmail(email: string): Promise<UserWithoutPassword | null> {
    return this.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        supabaseUserId: true,
        weightUnit: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Special method for authentication that includes password
  async findByEmailWithPassword(email: string) {
    return this.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        name: true,
      },
    });
  }

  async create({
    email,
    password,
    name,
  }: RegisterDto): Promise<UserWithoutPassword> {
    const hashedPassword = await bcrypt.hash(password, 10);

    return this.db.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        supabaseUserId: true,
        weightUnit: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
