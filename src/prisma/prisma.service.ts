import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { softDeleteExtension } from './prisma.extension';

function extendedPrismaClient(configService: ConfigService) {
  const adapter = new PrismaPg(
    configService.getOrThrow<string>('database.url'),
  );
  return new PrismaClient({ adapter }).$extends(softDeleteExtension);
}

type ExtendedPrismaClient = ReturnType<typeof extendedPrismaClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: ExtendedPrismaClient;

  constructor(configService: ConfigService) {
    this.client = extendedPrismaClient(configService);
  }

  get db(): ExtendedPrismaClient {
    return this.client;
  }

  async onModuleInit() {
    await this.client.$connect();
    this.logger.log('Connected to database');
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    this.logger.log('Disconnected from database');
  }
}
