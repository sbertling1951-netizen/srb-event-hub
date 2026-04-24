export type EventStatus = 'Draft' | 'Open' | 'Closing Soon' | 'Closed' | 'Waitlist Only' | 'Finalized' | 'Canceled';

export interface EventItem {
  id: string;
  name: string;
  locationName: string;
  address: string;
  startDate: string;
  endDate: string;
  eventCode: string;
  registrationCloseAt: string;
  attendeeEditCloseAt: string;
  status: EventStatus;
  latitude: number;
  longitude: number;
}

export interface AgendaItem {
  id: string;
  title: string;
  dayDate: string;
  startTime: string;
  endTime: string;
  locationName: string;
  description: string;
  isUpdated?: boolean;
}

export interface Attendee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  siteNumber: string;
  coach: string;
  visibility: 'hidden' | 'site' | 'name-site' | 'map';
}

export interface Activity {
  id: string;
  title: string;
  category: string;
  date: string;
  startTime: string;
  endTime: string;
  meetingLocation: string;
  address: string;
  latitude: number;
  longitude: number;
  price: number;
  capacity: number;
  booked: number;
  signupCloseAt: string;
  status: EventStatus;
  rvNote?: string;
}

export interface NearbyPlace {
  id: string;
  name: string;
  category: string;
  address: string;
  phone?: string;
  website?: string;
  latitude: number;
  longitude: number;
  rvNote?: string;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  priority: 'Normal' | 'Urgent';
  publishAt: string;
}
