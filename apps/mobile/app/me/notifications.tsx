import { FlatList, Text } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { dateTime } from '../../src/lib/format';
import { Button, Card, Empty, ErrorState, Loading } from '../../src/components/ui';
import { useLang, useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

interface N { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string }

/** Works even if push permission is denied: this is the source of truth for notifications. */
export default function NotificationsCenter() {
  const t = useT();
  const lang = useLang();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: N[]; unread: number; nextCursor: string | null }>(`/v1/me/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={items}
      keyExtractor={(n) => n.id}
      onRefresh={() => q.refetch()}
      refreshing={q.isRefetching}
      onEndReached={() => q.hasNextPage && q.fetchNextPage()}
      ListHeaderComponent={
        <>
          {q.isLoading ? <Loading /> : null}
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
          {!q.isLoading && items.length === 0 ? <Empty /> : null}
          {items.some((n) => !n.readAt) ? <Button title={t('markAllRead')} variant="ghost" onPress={() => api('/v1/me/notifications/read', { method: 'POST', body: { ids: 'all' } }).then(() => q.refetch())} /> : null}
        </>
      }
      renderItem={({ item: n }) => (
        <Card style={!n.readAt ? { borderColor: colors.emerald } : undefined}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{n.title}</Text>
          <Text style={{ fontSize: 15, color: colors.text }}>{n.body}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{dateTime(n.createdAt, lang)}</Text>
        </Card>
      )}
    />
  );
}
