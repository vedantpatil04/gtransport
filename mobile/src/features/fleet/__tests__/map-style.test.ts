import { loggableUrl, resolveMapStyle } from '../map-style';

describe('resolveMapStyle', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_URL;
  });

  it('is unavailable — not a built-in map — when nothing is configured', () => {
    expect(resolveMapStyle(undefined)).toEqual({ status: 'unavailable', reason: 'missing' });
    expect(resolveMapStyle('   ')).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('accepts an absolute http(s) style URL', () => {
    expect(resolveMapStyle('https://tiles.example.test/styles/liberty')).toEqual({ status: 'ready', styleUrl: 'https://tiles.example.test/styles/liberty' });
    expect(resolveMapStyle(' http://10.0.2.2:8080/style.json ')).toEqual({ status: 'ready', styleUrl: 'http://10.0.2.2:8080/style.json' });
  });

  it('refuses a Mapbox style and other schemes', () => {
    expect(resolveMapStyle('mapbox://styles/mapbox/streets-v12')).toEqual({ status: 'unavailable', reason: 'invalid' });
    expect(resolveMapStyle('ftp://tiles.example.test/style.json')).toEqual({ status: 'unavailable', reason: 'invalid' });
    expect(resolveMapStyle('/styles/liberty')).toEqual({ status: 'unavailable', reason: 'invalid' });
  });

  it('reads EXPO_PUBLIC_MAP_STYLE_URL by default', () => {
    process.env.EXPO_PUBLIC_MAP_STYLE_URL = 'https://tiles.example.test/style.json';
    expect(resolveMapStyle()).toEqual({ status: 'ready', styleUrl: 'https://tiles.example.test/style.json' });
  });

  it('logs a URL without its query string, where a provider key would ride', () => {
    expect(loggableUrl('https://tiles.example.test/style.json?key=SECRET')).toBe('https://tiles.example.test/style.json');
  });
});
