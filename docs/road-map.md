# Road map

Things Timed Tabs does not do yet, in rough order. The detailed working list is
private; this is the public summary.

- **Firefox for Android.** The manifest no longer declares Android support. The popup,
  the theme tint and the toolbar badge all need checking on a device before it goes
  back in, and some indicators may need an Android-specific fallback.
- **Chrome.** Planned, not yet supported. A Chrome build comes from the same source
  and is attached to every release so it can be tried, but it has not been submitted
  to the Chrome Web Store, and the tint indicator is Firefox-only.
- **Signed builds with an update URL**, so a beta install updates itself to the next
  release.
- **Tab groups.** Rules and settings for a whole browser tab group.
- **A warning before navigating away** from a tab that will close on expiry.
