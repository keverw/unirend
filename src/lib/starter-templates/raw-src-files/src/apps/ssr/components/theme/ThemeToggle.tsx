import { useTheme } from './context';

const labels: Record<string, string> = {
  auto: 'Theme: Auto',
  dark: 'Theme: Dark',
  light: 'Theme: Light',
};

export function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();

  return (
    <button
      onClick={cycleTheme}
      className="rounded border-4 border-dashed border-gray-400 px-6 py-3 font-medium text-gray-700 transition-colors hover:border-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:border-gray-400"
    >
      {labels[preference]}
    </button>
  );
}
