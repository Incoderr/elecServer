const ogs = require("open-graph-scraper");

const scrapeOgData = async (url) => {
  try {
    const { result } = await ogs({ url });
    if (result.success) {
      return {
        og_site_name: result.ogSiteName,
        og_title: result.ogTitle,
        og_description: result.ogDescription,
        og_image: result.ogImage?.[0]?.url || result.ogImage?.url,
        og_url: result.requestUrl || url,
      };
    }
    return {};
  } catch (err) {
    console.error("OGS error for URL:", url, err.message);
    return {};
  }
};

module.exports = { scrapeOgData };