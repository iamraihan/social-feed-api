import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { LikeTargetType } from '@prisma/client';

// URLs use lowercase (`/likes/post/...`); the enum values are uppercase (Prisma
// convention). This pipe normalizes the URL param and validates it in one step.
@Injectable()
export class ParseLikeTargetPipe implements PipeTransform<
  string,
  LikeTargetType
> {
  private readonly allowed = Object.values(LikeTargetType);

  transform(value: string): LikeTargetType {
    const upper = (value ?? '').toUpperCase() as LikeTargetType;
    if (!this.allowed.includes(upper)) {
      throw new BadRequestException(
        `Invalid target type "${value}". Expected one of: ${this.allowed
          .map((v) => v.toLowerCase())
          .join(', ')}`,
      );
    }
    return upper;
  }
}
