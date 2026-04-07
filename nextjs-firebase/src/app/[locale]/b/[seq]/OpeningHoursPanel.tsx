import styles from "./AdDetailsPage.module.css";

type Props = {
  compact?: boolean;
  lines: string[];
  title: string;
  todayLabel: string;
};

const WEEKDAYS_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function parseStructuredLine(line: string): { day: string; time: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0 || idx > 24) return null;
  const day = line.slice(0, idx).trim();
  const time = line.slice(idx + 1).trim();
  if (!day || !time) return null;
  return { day, time };
}

export default function OpeningHoursPanel({
  compact,
  lines,
  title,
  todayLabel,
}: Props) {
  const todayEn = WEEKDAYS_EN[new Date().getDay()];
  const todayKey = todayEn.toLowerCase();

  const panelClass = compact
    ? `${styles.hoursPanel} ${styles.hoursPanelCompact}`
    : styles.hoursPanel;

  return (
    <div className={panelClass}>
      <div className={styles.hoursHead}>
        <div className={styles.hoursIconWrap} aria-hidden>
          <svg
            className={styles.hoursIconSvg}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        </div>
        <div className={styles.hoursTitle}>{title}</div>
      </div>
      <ul className={styles.hoursList}>
        {lines.map((line, i) => {
          const structured = parseStructuredLine(line);
          const isToday =
            structured !== null &&
            structured.day.toLowerCase().startsWith(todayKey.slice(0, 3));

          if (!structured) {
            return (
              <li key={i} className={styles.hoursRow}>
                <div className={styles.hoursFullLine}>{line}</div>
              </li>
            );
          }

          return (
            <li
              key={i}
              className={`${styles.hoursRow}${isToday ? ` ${styles.hoursRowToday}` : ""}`}
            >
              <div className={styles.hoursDay}>
                {structured.day}
                {isToday ? (
                  <span className={styles.hoursTodayBadge}>{todayLabel}</span>
                ) : null}
              </div>
              <div className={styles.hoursTime}>{structured.time}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
