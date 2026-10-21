// Weather conditions a nightly report can record (must match the check in migration 009).
export const WEATHER_ORDER = ["sunny", "partly_cloudy", "cloudy", "fog", "windy", "rain", "storm", "snow"] as const;
export const WEATHER_LABELS: Record<string, string> = {
  sunny: "Sunny", partly_cloudy: "Partly cloudy", cloudy: "Cloudy", fog: "Fog", windy: "Windy", rain: "Rain", storm: "Storm", snow: "Snow",
};
