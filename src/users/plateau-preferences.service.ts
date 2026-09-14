import { Injectable } from '@nestjs/common';
import type { PlateauPreferences } from '@sunsteel/contracts';

import { DatabaseService } from '../database/database.service';

/**
 * PREF-05: the account's plateau-watch sensitivity. The plateau read returns
 * the value in use with every response, so there is no separate GET.
 */
@Injectable()
export class PlateauPreferencesService {
  constructor(private readonly db: DatabaseService) {}

  async update(
    userId: string,
    minSessions: number,
  ): Promise<PlateauPreferences> {
    const user = await this.db.user.update({
      where: { id: userId },
      data: { plateauMinSessions: minSessions },
      select: { plateauMinSessions: true },
    });
    return { minSessions: user.plateauMinSessions };
  }
}
