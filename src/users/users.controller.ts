import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrictAuthGuard } from '../auth/guards/jwt-strict-auth.guard';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Self-view routes come first so the static `me` segment is matched before
  // the `:id` parameter route.

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() current: JwtPayload) {
    return this.usersService.findById(current.sub);
  }

  // Profile edits go through the strict guard — a stale access token whose
  // user has been mass-revoked must not be able to mutate the account.
  @Patch('me')
  @UseGuards(JwtStrictAuthGuard)
  async updateMe(
    @CurrentUser() current: JwtPayload,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(current.sub, dto);
  }

  @Delete('me')
  @UseGuards(JwtStrictAuthGuard)
  @HttpCode(HttpStatus.OK)
  async removeMe(@CurrentUser() current: JwtPayload) {
    return this.usersService.softDelete(current.sub);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findPublicById(id);
  }
}
