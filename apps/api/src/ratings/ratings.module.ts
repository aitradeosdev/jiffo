import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';

@Module({ controllers: [RatingsController] })
export class RatingsModule {}
