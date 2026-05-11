import { UserStatus } from '@prisma/client';

// Self-view: returned when the authenticated user reads their own record.
export class UserDto {
  id!: string;
  firstName!: string;
  lastName!: string;
  email!: string;
  avatarKey!: string | null;
  status!: UserStatus;
  createdAt!: Date;
  updatedAt!: Date;
}

// Embed shape: used when surfacing a user as the author of a post / comment /
// reply, or in "who liked" lists. Deliberately excludes email and status.
export class PublicUserDto {
  id!: string;
  firstName!: string;
  lastName!: string;
  avatarKey!: string | null;
}
