import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const motionQueries = {
  desktop: "(min-width: 901px)",
  motion: "(prefers-reduced-motion: no-preference)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
};

/** Each homepage owns its timelines, media listeners, and scroll triggers. */
export function createHomepageMotion(root: HTMLElement) {
  const media = gsap.matchMedia();
  let mounted = true;

  media.add(
    motionQueries,
    (context) => {
      if (!context.conditions?.motion || context.conditions.reducedMotion)
        return;

      gsap.registerPlugin(ScrollTrigger);
      const select = gsap.utils.selector(root);
      const desktop = Boolean(context.conditions.desktop);
      const entrance = gsap.timeline({
        defaults: {
          duration: 0.9,
          ease: "power3.out",
          clearProps: "transform,opacity,visibility",
        },
      });

      entrance
        .from(select(".home-header"), { y: -10, autoAlpha: 0, duration: 0.65 })
        .from(
          select(".home-hero-copy > *"),
          {
            y: desktop ? 26 : 16,
            autoAlpha: 0,
            stagger: 0.09,
          },
          0.12,
        )
        .from(
          select(".home-artifact"),
          {
            y: desktop ? 36 : 20,
            autoAlpha: 0,
            stagger: 0.12,
            duration: 1.15,
          },
          0.42,
        );

      // A separate wrapper keeps scroll drift from fighting the card entrances.
      if (desktop) {
        gsap.to(select(".home-artifacts"), {
          y: -44,
          ease: "none",
          scrollTrigger: {
            trigger: select(".home-hero")[0],
            start: "top top",
            end: "bottom top",
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
        });
      }

      function reveal(targets: Element[], trigger: Element, stagger = 0) {
        gsap.from(targets, {
          y: desktop ? 28 : 16,
          autoAlpha: 0,
          duration: 0.85,
          ease: "power3.out",
          stagger,
          clearProps: "transform,opacity,visibility",
          scrollTrigger: { trigger, start: "top 92%", once: true },
        });
      }

      const intro = select(".home-section-intro")[0];
      reveal(select(".home-section-intro > *"), intro, 0.08);
      reveal(select(".home-tabs"), select(".home-tabs")[0]);
      reveal(select(".home-product-stage"), select(".home-product-stage")[0]);
      reveal(
        select(".home-workflow-heading > *"),
        select(".home-workflow-heading")[0],
        0.1,
      );

      select(".home-step").forEach((step: Element) => reveal([step], step));

      const callout = gsap.timeline({
        defaults: {
          duration: 0.9,
          ease: "power3.out",
          clearProps: "transform,opacity,visibility",
        },
        scrollTrigger: {
          trigger: select(".home-callout")[0],
          start: "top 88%",
          once: true,
        },
      });
      callout
        .from(select(".home-callout-copy > *"), {
          y: 24,
          autoAlpha: 0,
          stagger: 0.08,
        })
        .from(
          select(".home-handoff"),
          { y: 24, autoAlpha: 0, stagger: 0.18 },
          0.2,
        );

      reveal(select(".home-footer-top > *"), select(".home-footer")[0], 0.1);
    },
    root,
  );

  // Font metrics can move section boundaries after the first layout pass.
  void root.ownerDocument.fonts?.ready.then(() => {
    if (mounted && ScrollTrigger.getAll().length) ScrollTrigger.refresh();
  });

  return () => {
    mounted = false;
    media.revert();
  };
}

/** Tab content enters independently; switching tabs never replays page reveals. */
export function createExampleMotion(root: HTMLElement) {
  const media = gsap.matchMedia();

  media.add(
    "(prefers-reduced-motion: no-preference)",
    () => {
      gsap.from(root.querySelectorAll(".home-product-copy, .home-demo"), {
        y: 12,
        autoAlpha: 0,
        duration: 0.5,
        stagger: 0.06,
        ease: "power2.out",
        clearProps: "transform,opacity,visibility",
      });
      if (ScrollTrigger.getAll().length) ScrollTrigger.refresh();
    },
    root,
  );

  return () => media.revert();
}
