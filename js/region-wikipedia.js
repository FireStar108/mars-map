/* Offline article/image records. Never infer identity from an unverified name. */
(function (root) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function link(text, href) {
    const node = element("a", text);
    try {
      const url = new URL(href);
      if (url.protocol !== "https:") return element("span", text);
      node.href = url.href;
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    } catch {
      return element("span", text);
    }
    return node;
  }
  function render(region, fallback) {
    const record = root.MARS_WIKIPEDIA?.records[region.id];
    const host = $("region-wikipedia"),
      sources = $("region-text-source");
    host.replaceChildren();
    sources.replaceChildren();
    host.dataset.status = record?.status || "unavailable";
    const matched = record?.status === "article";
    let description = matched ? record.extract : fallback;
    if (matched && description.length > 420) {
      const sentences =
        typeof Intl.Segmenter === "function"
          ? [
              ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(
                description,
              ),
            ].map((s) => s.segment)
          : [description];
      let short = "";
      for (const sentence of sentences.slice(0, 3)) {
        if ((short + sentence).length > 420) break;
        short += sentence;
      }
      description =
        short.trim() || description.slice(0, 410).replace(/\s+\S*$/, "") + "…";
    }
    $("region-description").textContent = description;
    if (record?.image) {
      const photo = record.image;
      const figure = element("figure", null, "wiki-photo");
      const anchor = link("", photo.page);
      const image = document.createElement("img");
      image.src = photo.local;
      image.alt =
        photo.scope === "wikimedia"
          ? `Wikimedia image linked to the IAU entry for ${region.name}`
          : `Image accompanying the Wikipedia article about ${record.title}`;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener(
        "error",
        () => {
          anchor.replaceChildren(
            element(
              "p",
              "The saved image could not be loaded. Open its source below.",
              "wiki-missing",
            ),
          );
        },
        { once: true },
      );
      anchor.append(image);
      const caption = element("figcaption");
      caption.append(
        link(
          photo.scope === "wikimedia"
            ? "Wikimedia Commons image ↗"
            : "Wikipedia image ↗",
          photo.page,
        ),
        element("span", photo.license),
      );
      const credits = element("details", null, "wiki-credits");
      credits.append(element("summary", "Image credit & license"));
      credits.append(element("p", photo.author));
      if (photo.scope === "wikimedia")
        credits.append(
          element(
            "p",
            "Associated with this feature through its IAU identifier in Wikidata. Some images show regional context.",
          ),
        );
      if (photo.credit && photo.credit !== photo.author)
        credits.append(element("p", photo.credit));
      if (photo.caption) credits.append(element("p", photo.caption));
      credits.append(link(photo.license, photo.licenseUrl || photo.page));
      if (photo.license === "GFDL") {
        for (const version of ["1.2", "1.3"]) {
          const localLicense = element(
            "a",
            `Full GFDL ${version} license · local copy`,
          );
          localLicense.href = `assets/wikipedia/licenses/GFDL-${version}.txt`;
          localLicense.target = "_blank";
          credits.append(element("br"), localLicense);
        }
      }
      credits.append(
        element(
          "p",
          "Thumbnail retained from Wikimedia; original file and full attribution at the image source.",
        ),
      );
      figure.append(anchor, caption, credits);
      host.append(figure);
    } else {
      host.append(
        element(
          "p",
          matched
            ? "No reusable image was available in the matched Wikipedia article."
            : !record
              ? "Wikipedia information is not available in the local bundle yet."
              : "No matching English Wikipedia article and image found in this catalogue snapshot.",
          "wiki-missing",
        ),
      );
    }
    if (matched) {
      sources.append(link("Wikipedia · " + record.title + " ↗", record.url));
      const credit = element(
        "p",
        (record.scope === "table-entry"
          ? "Table-entry summary: "
          : record.scope === "related-article"
            ? "Related article excerpt: "
            : "Excerpt: ") + "Wikipedia contributors · ",
      );
      credit.append(
        link("CC BY-SA 4.0", record.textLicenseUrl),
        document.createTextNode(" · "),
        link("Source revision", record.revisionUrl),
      );
      sources.append(
        credit,
        element(
          "small",
          `Saved ${record.checked}. ${record.scope === "table-entry" ? "Summary of the matched crater-table row." : "Excerpt shortened; pronunciation markup removed where present."}`,
        ),
      );
    } else {
      sources.append(
        element(
          "p",
          "Description above: IAU catalogue / atlas context, not a Wikipedia excerpt.",
        ),
      );
      sources.append(
        link(
          "Search Wikipedia ↗",
          "https://en.wikipedia.org/w/index.php?search=" +
            encodeURIComponent(region.name + " Mars"),
        ),
      );
    }
  }
  root.MarsWikipedia = { render };
})(window);
