import { Link } from "react-router-dom";
import Icon from "./Icon";
const resources = [
  {
    label: "FIND SOMEONE TO TALK TO",
    title: "Support where you are",
    text: "Find a helpline by country and topic. Check each service’s hours, eligibility, and privacy information.",
    href: "https://findahelpline.com/",
    link: "Find a helpline",
  },
  {
    label: "LEARN AT YOUR OWN PACE",
    title: "Understand mental health",
    text: "Explore information about mental health and professional support from the World Health Organization.",
    href: "https://www.who.int/health-topics/mental-health",
    link: "Explore WHO resources",
  },
  {
    label: "TAKE THE NEXT STEP",
    title: "Connect with professional care",
    text: "A licensed mental health professional or your primary care provider can help you explore support suited to your needs.",
    href: "https://www.nimh.nih.gov/health/find-help",
    link: "Explore NIMH guidance",
  },
];
export default function Resources() {
  return (
    <main className="resources-page">
      <header>
        <Link to="/" className="wordmark">
          <span className="brand-mark">s.</span>still
        </Link>
        <Link className="back-link" to="/">
          <Icon name="arrow" size={17} />
          Back to your space
        </Link>
      </header>
      <section className="resources-intro">
        <span className="eyebrow">YOU DESERVE HUMAN SUPPORT</span>
        <h1>
          A little guidance.
          <br />
          <em>A place to begin.</em>
        </h1>
        <p>
          Some things are easier to carry with someone beside you.
          <br />
          These resources can help you find your next step.
        </p>
      </section>
      <section className="urgent-support">
        <Icon name="shield" size={26} />
        <div>
          <h2>If you need support right now</h2>
          <p>
            If you or someone else is in immediate danger, contact your local
            emergency services. Reach out to someone you trust who can stay with
            you. Still cannot provide emergency care or monitor your safety.
          </p>
          <a
            href="https://findahelpline.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Find local crisis support ↗
          </a>
        </div>
      </section>
      <section className="resource-grid" aria-label="Support resources">
        {resources.map((resource, index) => (
          <article key={resource.title}>
            <span className="resource-index">0{index + 1}</span>
            <span className="eyebrow">{resource.label}</span>
            <h2>{resource.title}</h2>
            <p>{resource.text}</p>
            <a href={resource.href} target="_blank" rel="noopener noreferrer">
              {resource.link}
              <span>↗</span>
            </a>
          </article>
        ))}
      </section>
      <section className="resource-reflection">
        <Icon name="leaf" size={28} />
        <h2>You can start small.</h2>
        <p>
          You don’t need the perfect words to ask for support.
          <br />
          “I’ve been having a difficult time. Could we talk?” is enough to
          begin.
        </p>
      </section>
      <footer>
        Still is a reflection companion. It does not provide medical advice,
        diagnosis, or treatment.
        <br />
        External resources open in a new tab and have their own privacy
        policies.
      </footer>
    </main>
  );
}
