# Release notice: listing photos are moving

**Feature**: `017-cloudinary-listing-media` | **Audience**: all community members
| **Send**: with, or immediately before, the deploy

Draft copy for the maintainers to send. The point of sending it is that this
change is **user-visible and destructive**: every listing photo uploaded before
the deploy is gone, and a seller who discovers that on their own will reasonably
assume something broke.

---

## Short version (in-app banner / chat message)

> **Listing photos need to be re-uploaded.**
> We've moved listing images to new storage so they load faster and survive
> deployments. Photos uploaded before today were not carried over — your listings
> are still there, but they'll show "No photo" until you add images again.
> Editing a listing and adding photos takes a few seconds, and you can now add up
> to **8** per listing (previously 6), reorder them, and choose which one is the
> cover.

---

## Longer version (email)

> **Subject:** Action needed — re-upload your listing photos
>
> Hi,
>
> We've rebuilt how CMarket stores listing images. The new system is faster, keeps
> your photos safe across app updates, and gives you more control.
>
> **What you need to do:** if you have listings with photos, open each one and
> upload the images again. Your listings, prices, stock, and messages are all
> unchanged — only the images are affected.
>
> **What's new while you're there:**
> - Up to **8 photos** per listing, up from 6
> - Select several at once, and see each one upload with its own progress
> - Drag-free reordering — use the arrow buttons, so it works on phones too
> - Pick exactly which photo is the **cover** shown in the community feed
> - If one photo fails to upload, retry just that one — the rest are kept
>
> **Why weren't the old photos moved?** They were stored in a way that could not
> be transferred safely, so rather than migrate something unreliable we made a
> clean switch. We're sorry for the manual step.
>
> Your images remain private to your community: they're only viewable by people
> signed in and currently a member, exactly as before.
>
> Thanks,
> The CMarket team

---

## Notes for whoever sends this

- **Do not send it after the deploy has been live for a while.** A seller who
  finds their photos missing without warning will file it as a bug.
- The "private to your community" line is accurate and worth keeping: delivery is
  re-authorized on every image request, so the change did not weaken access
  control. If anything it is now checked more often than before.
- Do not promise a recovery path. There isn't one — the old images are deleted by
  the migration, and only a pre-deploy database backup would contain them.
- The 6 → 8 photo increase is the one piece of good news in the message. Lead with
  it in any channel where the tone matters.
