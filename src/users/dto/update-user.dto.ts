import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

// Email change and password change belong to dedicated flows (with verification
// or current-password confirmation). Exclude them from the generic profile edit.
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'password'] as const),
) {}
