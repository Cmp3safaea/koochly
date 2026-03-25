import styles from "./page.module.css";

export default function CityAdsLoading() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.skeletonFlag} aria-hidden="true" />
          <div className={styles.skeletonTextWrap} aria-hidden="true">
            <div className={styles.skeletonTitle} />
            <div className={styles.skeletonSubtitle} />
          </div>
        </div>
      </header>

      <section className={styles.grid}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={styles.skeletonCard} aria-hidden="true" />
        ))}
      </section>
    </main>
  );
}

