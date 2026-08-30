const CITY_TIMEZONE_MAP: Record<string, string> = {
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  denver: 'America/Denver',
  seattle: 'America/Los_Angeles',
  miami: 'America/New_York',
  boston: 'America/New_York',
  austin: 'America/Chicago',
  london: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  tokyo: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  toronto: 'America/Toronto',
  vancouver: 'America/Vancouver',
  'mexico city': 'America/Mexico_City',
  'são paulo': 'America/Sao_Paulo',
  mumbai: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  dubai: 'Asia/Dubai',
  amsterdam: 'Europe/Amsterdam',
  stockholm: 'Europe/Stockholm',
  lisbon: 'Europe/Lisbon',
};

const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  'united states': 'America/New_York',
  usa: 'America/New_York',
  'united kingdom': 'Europe/London',
  uk: 'Europe/London',
  canada: 'America/Toronto',
  australia: 'Australia/Sydney',
  japan: 'Asia/Tokyo',
  germany: 'Europe/Berlin',
  france: 'Europe/Paris',
  brazil: 'America/Sao_Paulo',
  india: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  'united arab emirates': 'Asia/Dubai',
  mexico: 'America/Mexico_City',
  netherlands: 'Europe/Amsterdam',
  sweden: 'Europe/Stockholm',
  portugal: 'Europe/Lisbon',
  spain: 'Europe/Madrid',
  italy: 'Europe/Rome',
};

export const getTimezoneFromLocation = (city: string, country: string): string => {
  const normalizedCity = city.trim().toLowerCase();
  const normalizedCountry = country.trim().toLowerCase();

  return CITY_TIMEZONE_MAP[normalizedCity] ?? COUNTRY_TIMEZONE_MAP[normalizedCountry] ?? 'UTC';
};

export const formatTimezoneDisplay = (timezone: string): string => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatter.format(now)} (${timezone})`;
};
