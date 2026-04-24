import { Activity, AgendaItem, Announcement, Attendee, EventItem, NearbyPlace } from './types';

export const currentEvent: EventItem = {
  id: '1',
  name: 'FCOC Spring Junction',
  locationName: 'Branson Rally Grounds',
  address: '1000 FCOC Drive, Branson, MO 65616',
  startDate: '2026-04-22',
  endDate: '2026-04-26',
  eventCode: 'BRANSON26',
  registrationCloseAt: '2026-04-10T23:59:00',
  attendeeEditCloseAt: '2026-04-12T23:59:00',
  status: 'Open',
  latitude: 36.6437,
  longitude: -93.2185,
};

export const agenda: AgendaItem[] = [
  {
    id: 'a1',
    title: 'Registration and Coach Parking',
    dayDate: '2026-04-22',
    startTime: '12:00 PM',
    endTime: '5:00 PM',
    locationName: 'Welcome Tent',
    description: 'Check in, pick up packets, and proceed to assigned parking area.',
  },
  {
    id: 'a2',
    title: 'Welcome Social',
    dayDate: '2026-04-22',
    startTime: '6:00 PM',
    endTime: '7:30 PM',
    locationName: 'Main Pavilion',
    description: 'Meet members, review event highlights, and hear announcements.',
    isUpdated: true,
  },
  {
    id: 'a3',
    title: 'Technical Seminar: Chassis Basics',
    dayDate: '2026-04-23',
    startTime: '9:00 AM',
    endTime: '10:15 AM',
    locationName: 'Seminar Hall A',
    description: 'A member-friendly tech session on maintenance and inspections.',
  },
];

export const attendees: Attendee[] = [
  { id: 'u1', firstName: 'Jan', lastName: 'Miller', email: 'jan@example.com', siteNumber: 'A12', coach: 'Newmar Ventana', visibility: 'name-site' },
  { id: 'u2', firstName: 'Steve', lastName: 'Barton', email: 'steve@example.com', siteNumber: 'A14', coach: 'Tiffin Phaeton', visibility: 'map' },
  { id: 'u3', firstName: 'Carol', lastName: 'Dunn', email: 'carol@example.com', siteNumber: 'B03', coach: 'Entegra Aspire', visibility: 'site' },
];

export const activities: Activity[] = [
  {
    id: 't1',
    title: 'Historic Branson Bus Tour',
    category: 'Tour',
    date: '2026-04-24',
    startTime: '10:00 AM',
    endTime: '2:00 PM',
    meetingLocation: 'Bus Loading Zone',
    address: '1100 FCOC Drive, Branson, MO 65616',
    latitude: 36.644,
    longitude: -93.219,
    price: 35,
    capacity: 40,
    booked: 31,
    signupCloseAt: '2026-04-15T12:00:00',
    status: 'Open',
    rvNote: 'Use event shuttle pickup. Do not drive your coach.',
  },
  {
    id: 't2',
    title: 'Lake Boat Ride',
    category: 'Boat Ride',
    date: '2026-04-25',
    startTime: '1:30 PM',
    endTime: '4:00 PM',
    meetingLocation: 'Marina Dock',
    address: '330 Marina Way, Branson, MO 65616',
    latitude: 36.635,
    longitude: -93.229,
    price: 48,
    capacity: 28,
    booked: 28,
    signupCloseAt: '2026-04-12T17:00:00',
    status: 'Waitlist Only',
    rvNote: 'Best reached by toad or club shuttle.',
  },
];

export const nearbyPlaces: NearbyPlace[] = [
  {
    id: 'n1',
    name: 'Big Rig Fuel Stop',
    category: 'Fuel',
    address: '2200 Highway 65, Branson, MO 65616',
    phone: '417-555-0111',
    latitude: 36.652,
    longitude: -93.217,
    rvNote: 'Large coach access with diesel lanes.',
  },
  {
    id: 'n2',
    name: 'Lakeside Pharmacy',
    category: 'Pharmacy',
    address: '810 Main Street, Branson, MO 65616',
    phone: '417-555-0123',
    website: 'https://example.com/pharmacy',
    latitude: 36.641,
    longitude: -93.214,
  },
  {
    id: 'n3',
    name: 'RapidCare Urgent Care',
    category: 'Urgent Care',
    address: '900 Clinic Way, Branson, MO 65616',
    phone: '417-555-0150',
    latitude: 36.645,
    longitude: -93.205,
  },
];

export const announcements: Announcement[] = [
  {
    id: 'm1',
    title: 'Welcome Social moved indoors',
    message: 'Due to weather, tonight’s welcome social will be in Main Pavilion East.',
    priority: 'Urgent',
    publishAt: '2026-04-22T15:30:00',
  },
  {
    id: 'm2',
    title: 'Tech seminar handouts posted',
    message: 'Seminar materials are available at the registration tent and in the app downloads section.',
    priority: 'Normal',
    publishAt: '2026-04-23T08:00:00',
  },
];
