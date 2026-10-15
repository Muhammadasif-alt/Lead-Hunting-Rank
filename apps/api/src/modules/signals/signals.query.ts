import { Injectable } from '@nestjs/common';
import { companySignals, listSignalRules, listSignals, listWatchlists, searchSignals, signalAnalytics, signalDetail, signalOverview, watchlistDetail } from '@revenue-os/signals';
import type { SignalListQuery } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

/** Signal Center reads (screen #9) — read models from @revenue-os/signals in the shared API shapes. */
@Injectable()
export class SignalsQuery {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  overview(workspaceId: string) {
    return signalOverview(this.db, workspaceId);
  }

  list(workspaceId: string, q: SignalListQuery) {
    return listSignals(this.db, workspaceId, q);
  }

  search(workspaceId: string, q: string) {
    return searchSignals(this.db, workspaceId, q);
  }

  analytics(workspaceId: string, days: number) {
    return signalAnalytics(this.db, workspaceId, days);
  }

  detail(workspaceId: string, id: string) {
    return signalDetail(this.db, workspaceId, id);
  }

  company(workspaceId: string, companyId: string) {
    return companySignals(this.db, workspaceId, companyId);
  }

  watchlists(workspaceId: string) {
    return listWatchlists(this.db, workspaceId);
  }

  watchlist(workspaceId: string, id: string) {
    return watchlistDetail(this.db, workspaceId, id);
  }

  async rules(workspaceId: string) {
    return listSignalRules(this.db, workspaceId);
  }
}
