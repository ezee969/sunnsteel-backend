import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Delete,
  UseGuards,
  Patch,
  Query,
} from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { JwtAuthGuard } from '../auth/guards/passport-jwt.guard';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateFavoriteDto } from './dto/update-favorite.dto';
import { UpdateCompletedDto } from './dto/update-completed.dto';
import { GetRoutinesFilterDto } from './dto/get-routines-filter.dto';
import { Request } from 'express';

type RequestWithUser = Request & { user: { userId: string; email: string } };

@UseGuards(JwtAuthGuard)
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routinesService: RoutinesService) {}

  @Post()
  async create(@Req() req: RequestWithUser, @Body() dto: CreateRoutineDto) {
    return this.routinesService.create(req.user.userId, dto);
  }

  @Get()
  async findAll(
    @Req() req: RequestWithUser,
    @Query() filter: GetRoutinesFilterDto,
  ) {
    return this.routinesService.findAll(req.user.userId, filter);
  }

  @Get('favorites')
  async findFavorites(@Req() req: RequestWithUser) {
    return this.routinesService.findFavorites(req.user.userId);
  }

  @Get('completed')
  async findCompleted(@Req() req: RequestWithUser) {
    return this.routinesService.findCompleted(req.user.userId);
  }

  @Get(':id')
  async findOne(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.routinesService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  async update(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: CreateRoutineDto,
  ) {
    return await this.routinesService.update(req.user.userId, id, dto);
  }

  @Patch(':id/favorite')
  async setFavorite(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateFavoriteDto,
  ) {
    return this.routinesService.setFavorite(
      req.user.userId,
      id,
      dto.isFavorite,
    );
  }

  @Patch(':id/completed')
  async setCompleted(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompletedDto,
  ) {
    return this.routinesService.setCompleted(
      req.user.userId,
      id,
      dto.isCompleted,
    );
  }

  @Delete(':id')
  async remove(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.routinesService.remove(req.user.userId, id);
  }
}
