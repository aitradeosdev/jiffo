import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

const ThemeContext = createContext<{ colors: Palette; scheme: 'light' | 'dark' }>({ colors: light, scheme: 'light' });

/** Follows the phone's light or dark setting, like the prototypes. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <ThemeContext.Provider value={{ colors: scheme === 'dark' ? dark : light, scheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useColors = () => useContext(ThemeContext).colors;
export const useScheme = () => useContext(ThemeContext).scheme;
