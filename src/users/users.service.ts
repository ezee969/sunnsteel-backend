// Utility
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// Services
import { DatabaseService } from '../database/database.service';
import {
  PublicUserProfile,
  UpdateProfileRequest,
  UserProfile,
  UserSearchResponse,
} from '@sunsteel/contracts';
import { Prisma } from '@prisma/client';
import {
  createInitialUsername,
  getUsernameValidationError,
  normalizeUsername,
} from './username';

// Local input type replacing legacy RegisterDto
interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

const userProfileSelect = {
  timeZone: true,
  id: true,
  email: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
  age: true,
  sex: true,
  weight: true,
  height: true,
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

type UserProfileRecord = Prisma.UserGetPayload<{
  select: typeof userProfileSelect;
}>;

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  // Serialization boundary: Prisma record -> `UserProfile` contract
  // (folds follow counts, converts Date -> ISO string).
  private mapUserProfile(user: UserProfileRecord): UserProfile {
    const { _count, createdAt, updatedAt, ...profile } = user;
    return {
      ...profile,
      followerCount: _count.followers,
      followingCount: _count.following,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
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
  }: CreateUserInput): Promise<UserProfile> {
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.db.user.create({
      data: {
        email,
        username: createInitialUsername(name, email),
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
  ): Promise<UserProfile> {
    const username =
      data.username === undefined
        ? undefined
        : this.validateUsername(data.username);

    try {
      const user = await this.db.user.update({
        where: { email },
        data: {
          username,
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
    } catch (error) {
      if (this.isUniqueUsernameViolation(error)) {
        throw new ConflictException('Username is already taken');
      }
      throw error;
    }
  }

  async searchUsers(
    query: string,
    excludeUserId: string,
    limit: number = 10,
  ): Promise<UserSearchResponse[]> {
    if (!query || query.trim() === '') return [];

    const trimmedQuery = query.trim();
    const usernameQuery = normalizeUsername(trimmedQuery);
    if (trimmedQuery.startsWith('@') && !usernameQuery) return [];
    const searches: Prisma.UserWhereInput[] = trimmedQuery.startsWith('@')
      ? [{ username: { contains: usernameQuery, mode: 'insensitive' } }]
      : [
          { name: { contains: trimmedQuery, mode: 'insensitive' } },
          { lastName: { contains: trimmedQuery, mode: 'insensitive' } },
          { username: { contains: usernameQuery, mode: 'insensitive' } },
        ];

    return this.db.user.findMany({
      where: {
        id: { not: excludeUserId },
        OR: searches,
      },
      select: {
        id: true,
        username: true,
        name: true,
        lastName: true,
        avatarUrl: true,
      },
      take: limit,
      orderBy: [{ username: 'asc' }, { name: 'asc' }],
    });
  }

  async getPublicProfile(
    viewerUserId: string,
    targetIdentifier: string,
  ): Promise<PublicUserProfile> {
    const user = await this.db.user.findFirst({
      where: {
        OR: [
          { id: targetIdentifier },
          { username: normalizeUsername(targetIdentifier) },
        ],
      },
      select: {
        id: true,
        username: true,
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
          followingId: user.id,
        },
      },
      select: { followerId: true },
    });

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
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

    return this.getPublicProfile(viewerUserId, targetUserId);
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

    return this.getPublicProfile(viewerUserId, targetUserId);
  }

  private validateUsername(value: string): string {
    const username = normalizeUsername(value);
    const error = getUsernameValidationError(username);
    if (error === 'RESERVED') {
      throw new BadRequestException('This username is reserved');
    }
    if (error === 'INVALID_FORMAT') {
      throw new BadRequestException(
        'Username must be 3-30 characters, use letters, numbers, underscores or hyphens, and start and end with a letter or number',
      );
    }
    return username;
  }

  private isUniqueUsernameViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (Array.isArray(error.meta?.target)
        ? error.meta.target.includes('username')
        : String(error.meta?.target).includes('username'))
    );
  }
}
