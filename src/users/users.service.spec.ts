import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { RegisterDto } from '../auth/dto/auth.dto';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('UsersService', () => {
  let service: UsersService;
  let databaseService: DatabaseService;

  const mockUser = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashedPassword',
    supabaseUserId: null,
    weightUnit: 'KG' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserWithPassword = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashedPassword',
    supabaseUserId: null,
    weightUnit: 'KG' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockDatabaseService = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    databaseService = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('should return user without password when found', async () => {
      jest
        .spyOn(databaseService.user, 'findUnique')
        .mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(databaseService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
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
      expect(result).toEqual(mockUser);
    });

    it('should return null when user not found', async () => {
      jest.spyOn(databaseService.user, 'findUnique').mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findByEmailWithPassword', () => {
    it('should return user with password when found', async () => {
      jest
        .spyOn(databaseService.user, 'findUnique')
        .mockResolvedValue(mockUserWithPassword);

      const result = await service.findByEmailWithPassword('test@example.com');

      expect(databaseService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: {
          id: true,
          email: true,
          password: true,
          name: true,
        },
      });
      expect(result).toEqual(mockUserWithPassword);
    });

    it('should return null when user not found', async () => {
      jest.spyOn(databaseService.user, 'findUnique').mockResolvedValue(null);

      const result = await service.findByEmailWithPassword(
        'nonexistent@example.com',
      );

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    const registerDto: RegisterDto = {
      email: 'newuser@example.com',
      password: 'password123',
      name: 'New User',
    };

    it('should create a new user with hashed password', async () => {
      const hashedPassword = 'hashedPassword123';
      mockedBcrypt.hash.mockResolvedValue(hashedPassword as never);
      jest.spyOn(databaseService.user, 'create').mockResolvedValue(mockUser);

      const result = await service.create(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
      expect(databaseService.user.create).toHaveBeenCalledWith({
        data: {
          email: registerDto.email,
          password: hashedPassword,
          name: registerDto.name,
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
      expect(result).toEqual(mockUser);
    });
  });
});
