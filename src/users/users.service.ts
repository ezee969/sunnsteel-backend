// Local input type replacing legacy RegisterDto
interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}
// Utility
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// Services
import { DatabaseService } from 'src/database/database.service';
import { UserWithoutPassword } from './types/user.type';
import { UpdateProfileRequest } from '@sunsteel/contracts';
import { Prisma } from '@prisma/client';

const userProfileSelect = {
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
  _count: {
    select: {
      followers: true,
      following: true,
    },
  },
} as const;

type UserProfileRecord = Prisma.UserGetPayload<{ select: typeof userProfileSelect }>;
type UserProfileWithFollowCounts = UserWithoutPassword & {
  followerCount: number;
  followingCount: number;
};

export interface PublicUserProfile {
  id: string;
  name: string;
  lastName?: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  followerCount: number;
  followingCount: number;
  isFollowedByMe: boolean;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) { }

  private mapUserProfile(user: UserProfileRecord): UserProfileWithFollowCounts {
    const { _count, ...profile } = user;
    return {
      ...profile,
      followerCount: _count.followers,
      followingCount: _count.following,
    };
  }

  async findByEmail(email: string): Promise<UserProfileWithFollowCounts | null> {
    const user = await this.db.user.findUnique({
      where: { email },
      select: userProfileSelect,
    });
    if (!user) return null;
    return this.mapUserProfile(user);
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
  }: CreateUserInput): Promise<UserProfileWithFollowCounts> {
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.db.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  async updateProfile(
    email: string,
    data: UpdateProfileRequest,
  ): Promise<UserProfileWithFollowCounts> {
    const user = await this.db.user.update({
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
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  async searchUsers(query: string, excludeEmail: string, limit: number = 10) {
    if (!query || query.trim() === '') return [];

    // search across name, lastName, and email
    return this.db.user.findMany({
      where: {
        email: { not: excludeEmail },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        avatarUrl: true,
      },
      take: limit,
      orderBy: {
        name: 'asc',
      },
    });
  }

  async getPublicProfileById(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<PublicUserProfile> {
    const user = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        lastName: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const followRelation = await this.db.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId: viewerUserId,
          followingId: targetUserId,
        },
      },
      select: { followerId: true },
    });

    return {
      id: user.id,
      name: user.name,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      isFollowedByMe: !!followRelation,
    };
  }

  async followUser(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<PublicUserProfile> {
    if (viewerUserId === targetUserId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetUser = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    try {
      await this.db.userFollow.create({
        data: {
          followerId: viewerUserId,
          followingId: targetUserId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code !== 'P2002'
      ) {
        throw error;
      }
    }

    return this.getPublicProfileById(viewerUserId, targetUserId);
  }

  async unfollowUser(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<PublicUserProfile> {
    if (viewerUserId === targetUserId) {
      throw new BadRequestException('You cannot unfollow yourself');
    }

    const targetUser = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    await this.db.userFollow.deleteMany({
      where: {
        followerId: viewerUserId,
        followingId: targetUserId,
      },
    });

    return this.getPublicProfileById(viewerUserId, targetUserId);
  }
}
