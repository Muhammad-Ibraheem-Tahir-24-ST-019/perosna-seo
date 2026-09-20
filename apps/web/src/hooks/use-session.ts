'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@indexpilot/shared/client';
import { api, ApiError } from '@/lib/api';

export const sessionKey = ['session'] as const;

/**
 * Current user. A 401 is a normal, expected state (signed out) rather than an
 * error, so it resolves to null instead of throwing into an error boundary.
 */
export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        const { user } = await api.auth.me();
        return user;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return null;
        }
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login');
      router.refresh();
    },
  });
}

export function isAdmin(user: SessionUser | null | undefined): boolean {
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
}
