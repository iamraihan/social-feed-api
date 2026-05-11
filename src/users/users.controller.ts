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
} from '@nestjs/common';
import { UpdateUserDto } from './dto';
import { UsersService } from './users.service';

// TODO(auth-branch): all endpoints require an authenticated user.
// PATCH and DELETE additionally require an ownership check — the JWT-derived
// requester id must match :id. Wire JwtAuthGuard + a CurrentUser decorator,
// then add a parallel `/users/me` set that resolves :id from the JWT.
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findPublicById(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.softDelete(id);
  }
}
