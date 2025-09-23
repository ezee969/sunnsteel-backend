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
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { UpdateFavoriteDto } from './dto/update-favorite.dto';
import { UpdateCompletedDto } from './dto/update-completed.dto';
import { GetRoutinesFilterDto } from './dto/get-routines-filter.dto';
import { CreateTmEventDto } from './dto/tm-adjustment.dto';
import { Request } from 'express';

type RequestWithUser = Request & { user: { id: string; email: string } };

@UseGuards(SupabaseJwtGuard)
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routinesService: RoutinesService) {}

  @Post()
  async create(@Req() req: RequestWithUser, @Body() dto: CreateRoutineDto) {
    return this.routinesService.create(req.user.id, dto);
  }

  @Get()
  async findAll(
    @Req() req: RequestWithUser,
    @Query() filter: GetRoutinesFilterDto,
  ) {
    return this.routinesService.findAll(req.user.id, filter);
  }

  @Get('favorites')
  async findFavorites(@Req() req: RequestWithUser) {
    return this.routinesService.findFavorites(req.user.id);
  }

  @Get('completed')
  async findCompleted(@Req() req: RequestWithUser) {
    return this.routinesService.findCompleted(req.user.id);
  }

  @Get(':id')
  async findOne(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.routinesService.findOne(req.user.id, id);
  }

  @Patch(':id')
  async update(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoutineDto,
  ) {
    return await this.routinesService.update(req.user.id, id, dto);
  }

  @Patch(':id/favorite')
  async setFavorite(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateFavoriteDto,
  ) {
    return this.routinesService.setFavorite(req.user.id, id, dto.isFavorite);
  }

  @Patch(':id/completed')
  async setCompleted(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompletedDto,
  ) {
    return this.routinesService.setCompleted(req.user.id, id, dto.isCompleted);
  }

  @Delete(':id')
  async remove(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.routinesService.remove(req.user.id, id);
  }

  // TM Adjustment endpoints
  
  /**
   * Create a new TM adjustment event
   * POST /routines/:id/tm-events
   */
  @Post(':id/tm-events')
  async createTmAdjustment(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Body() dto: CreateTmEventDto
  ) {
    const result = await this.routinesService.createTmAdjustment(
      req.user.id, 
      routineId, 
      dto
    );

    // Log significant adjustments for monitoring (hardcoded threshold: 15kg)
    if (Math.abs(dto.deltaKg) > 15) {
      console.warn(`Large TM adjustment detected: ${dto.deltaKg}kg for routine ${routineId}, exercise ${dto.exerciseId}`);
    }

    return result;
  }

  /**
   * Get TM adjustment events for a routine
   * GET /routines/:id/tm-events
   */
  @Get(':id/tm-events')
  async getTmAdjustments(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Query('exerciseId') exerciseId?: string,
    @Query('minWeek') minWeek?: string,
    @Query('maxWeek') maxWeek?: string
  ) {
    return this.routinesService.getTmAdjustments(
      req.user.id,
      routineId,
      exerciseId,
      minWeek ? parseInt(minWeek, 10) : undefined,
      maxWeek ? parseInt(maxWeek, 10) : undefined
    );
  }

  /**
   * Get TM adjustment summary statistics
   * GET /routines/:id/tm-events/summary
   */
  @Get(':id/tm-events/summary')
  async getTmAdjustmentSummary(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string
  ) {
    return this.routinesService.getTmAdjustmentSummary(req.user.id, routineId);
  }
}
