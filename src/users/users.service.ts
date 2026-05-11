import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto';

const BCRYPT_ROUNDS = 10;

// Default select for any path that returns the user to its own owner.
// The password hash is intentionally omitted — never surface it from this service.
export const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatarKey: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// Embed shape for post / comment / reply authors and "who liked" lists.
// Exported so other modules can use it in their own relation includes.
export const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatarKey: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    try {
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      return await this.prisma.db.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          password: passwordHash,
          avatarKey: dto.avatarKey,
        },
        select: USER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      this.logger.error('Failed to create user', error);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async findById(id: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  // Returned by GET /users/:id. Excludes email + status — those are self-view
  // fields only, not safe to surface to anyone who knows another user's id.
  async findPublicById(id: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Login-only helper. Returns the password hash alongside the user record;
   * the caller MUST be the auth service and MUST NOT serialize this object
   * back over the wire. Returns null when the email is unknown so the caller
   * can decide whether to surface "not found" vs "invalid credentials".
   */
  async findByEmailWithPassword(email: string) {
    return this.prisma.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findById(id);

    try {
      return await this.prisma.db.user.update({
        where: { id },
        data: dto,
        select: USER_SELECT,
      });
    } catch (error) {
      this.logger.error(`Failed to update user ${id}`, error);
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async softDelete(id: string) {
    await this.findById(id);

    return this.prisma.db.user.update({
      where: { id },
      data: { status: 'DELETED' },
      select: USER_SELECT,
    });
  }
}
