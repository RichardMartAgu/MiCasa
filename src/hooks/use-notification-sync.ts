import { useEffect, useRef } from 'react';

import { useAuth } from '@/context/auth-context';
import { useCasa } from '@/context/casa-context';
import { useRealtimeCollection } from '@/hooks/use-realtime-collection';
import { fetchAppointments, fetchContacts, fetchFridgeItems } from '@/lib/api';
import {
  areNotificationsEnabled,
  ensureChannel,
  getBirthdayChoice,
  getFridgeChoice,
  setupNotificationHandler,
  syncAll,
} from '@/lib/notifications';
import type { Appointment, Contact, FridgeItem } from '@/lib/types';

export function useNotificationSync(): void {
  const { user } = useAuth();
  const { currentCasa } = useCasa();
  const { data: appointments, loading: appointmentsLoading } = useRealtimeCollection<Appointment>(
    () => (currentCasa ? fetchAppointments(currentCasa.id) : Promise.resolve([])),
    'appointments',
    currentCasa?.id ?? null,
  );
  const { data: contacts, loading: contactsLoading } = useRealtimeCollection<Contact>(
    () => (currentCasa ? fetchContacts(currentCasa.id) : Promise.resolve([])),
    'contacts',
    currentCasa?.id ?? null,
  );
  const { data: fridgeItems, loading: fridgeLoading } = useRealtimeCollection<FridgeItem>(
    () => (currentCasa ? fetchFridgeItems(currentCasa.id) : Promise.resolve([])),
    'fridge_items',
    currentCasa?.id ?? null,
  );

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setupNotificationHandler();
    void ensureChannel();
  }, []);

  useEffect(() => {
    if (!user || !currentCasa || appointmentsLoading || contactsLoading || fridgeLoading) return;
    let active = true;
    (async () => {
      const enabled = await areNotificationsEnabled();
      if (!active || !enabled) return;
      const birthdayChoice = await getBirthdayChoice();
      const fridgeChoice = await getFridgeChoice();
      await syncAll(
        appointments,
        contacts,
        birthdayChoice,
        new Date(),
        fridgeItems,
        fridgeChoice,
        user.id,
      );
    })();
    return () => {
      active = false;
    };
  }, [
    user,
    currentCasa,
    appointments,
    contacts,
    fridgeItems,
    appointmentsLoading,
    contactsLoading,
    fridgeLoading,
  ]);
}
