import { useTheme } from './context';

const icons: Record<string, string> = { auto: '🌓', dark: '🌙', light: '☀️' };
const labels: Record<string, string> = {
  auto: 'Auto',
  dark: 'Dark',
  light: 'Light',
};

export function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();

  return (
    <button
      onClick={cycleTheme}
      style={{
        fontSize: '0.9rem',
        marginLeft: '1rem',
        padding: '0.4em 0.9em',
        cursor: 'pointer',
      }}
      title={`Theme: ${labels[preference]} — click to cycle`}
    >
      {icons[preference]} {labels[preference]}
    </button>
  );
}
