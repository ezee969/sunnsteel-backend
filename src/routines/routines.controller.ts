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
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { UpdateFavoriteDto } from './dto/update-favorite.dto';
import { UpdateCompletedDto } from './dto/update-completed.dto';
import { GetRoutinesFilterDto } from './dto/get-routines-filter.dto';
import { RequestWithUser } from '../common/types/request-with-user';

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

  @Patch(':id/exercises/:exerciseId/note')
  async updateExerciseNote(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Param('exerciseId') exerciseId: string,
    @Body('note') note: string,
  ) {
    return this.routinesService.updateExerciseNote(
      req.user.id,
      routineId,
      exerciseId,
      note,
    );
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
}
