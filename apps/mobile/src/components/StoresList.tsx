import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { Paginated, StoreSummary } from '@bitaqati/shared';
import { api } from '../lib/api';
import { colors, radius } from '../theme';
import { useLang, useT } from '../state/lang';
import { StoreRow } from './domain';
import { Banner, Empty, ErrorState, Field, Loading } from './ui';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, borderColor: active ? colors.emerald : colors.border, backgroundColor: active ? colors.emeraldLight : colors.surface }}>
      <Text style={{ color: colors.navy }}>{label}</Text>
    </Pressable>
  );
}

/** Public directory (works signed out). Location is requested only when "Near me" is tapped, and never stored. */
export function StoresList() {
  const t = useT();
  const lang = useLang();
  const [q, setQ] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [minRate, setMinRate] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: string; name: { ar: string; en: string } }>>('/v1/categories', { auth: false }) });
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => api<string[]>('/v1/cities', { auth: false }) });
  const list = useInfiniteQuery({
    queryKey: ['stores', q, city, categoryId, minRate, coords],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '20' });
      if (q.trim()) p.set('q', q.trim());
      if (city) p.set('city', city);
      if (categoryId) p.set('categoryId', categoryId);
      if (minRate) p.set('minRateBps', String(minRate));
      if (coords) {
        p.set('lat', String(coords.lat));
        p.set('lng', String(coords.lng));
      }
      if (pageParam) p.set('cursor', pageParam);
      return api<Paginated<StoreSummary & { distanceKm?: number | null }>>(`/v1/stores?${p}`);
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const nearMe = async () => {
    if (coords) return setCoords(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return setLocDenied(true);
    setLocDenied(false);
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setCoords({ lat: Math.round(pos.coords.latitude * 1000) / 1000, lng: Math.round(pos.coords.longitude * 1000) / 1000 });
  };
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      data={items}
      keyExtractor={(s) => s.id}
      onRefresh={() => list.refetch()}
      refreshing={list.isRefetching}
      onEndReached={() => list.hasNextPage && list.fetchNextPage()}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <Field label={t('searchStores')} value={q} onChangeText={setQ} returnKeyType="search" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={t('nearMe')} active={!!coords} onPress={nearMe} />
            {[1000, 2000, 3000].map((r) => <Chip key={r} label={`≥ ${r / 100}%`} active={minRate === r} onPress={() => setMinRate(minRate === r ? null : r)} />)}
          </View>
          {locDenied ? <Banner kind="warn">{t('locationDenied')}</Banner> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={t('allCities')} active={!city} onPress={() => setCity(null)} />
            {cities.data?.map((c) => <Chip key={c} label={c} active={city === c} onPress={() => setCity(c)} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={t('allCategories')} active={!categoryId} onPress={() => setCategoryId(null)} />
            {cats.data?.map((c) => <Chip key={c.id} label={c.name[lang]} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} />)}
          </View>
          {list.isLoading ? <Loading /> : null}
          {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
          {!list.isLoading && !list.error && items.length === 0 ? <Empty /> : null}
        </View>
      }
      renderItem={({ item }) => <StoreRow store={item} onPress={() => router.push(`/store/${item.id}`)} />}
    />
  );
}
