// Local input type replacing legacy RegisterDto
interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}
// Utility
import * as bcrypt from 'bcrypt';
import { Injectable } from '@nestjs/common';
// Services
import { DatabaseService } from 'src/database/database.service';
import { UserWithoutPassword } from './types/user.type';
import { UpdateProfileRequest } from '@sunsteel/contracts';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) { }

  async findByEmail(email: string): Promise<UserWithoutPassword | null> {
    return this.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        avatarUrl: true,
        age: true,
        sex: true,
        weight: true,
        height: true,
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
  }: CreateUserInput): Promise<UserWithoutPassword> {
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
        lastName: true,
        avatarUrl: true,
        age: true,
        sex: true,
        weight: true,
        height: true,
        supabaseUserId: true,
        weightUnit: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateProfile(email: string, data: UpdateProfileRequest): Promise<UserWithoutPassword> {
    return this.db.user.update({
      where: { email },
      data: {
        name: data.name,
        lastName: data.lastName,
        avatarUrl: data.avatarUrl,
        age: data.age,
        sex: data.sex,
        weight: data.weight,
        height: data.height,
        weightUnit: data.weightUnit,
      },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        avatarUrl: true,
        age: true,
        sex: true,
        weight: true,
        height: true,
        supabaseUserId: true,
        weightUnit: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
