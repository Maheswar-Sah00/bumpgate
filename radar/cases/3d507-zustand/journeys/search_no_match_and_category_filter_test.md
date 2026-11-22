---
mode: testing
max_steps: 25
---

# Searching for something that does not exist shows a clear empty message, and category filters still work

## Search for a movement that does not exist
Click the search box with the placeholder "Search movements, #number…" and type "flux capacitor".
Verify the catalogue shows the message "No movements match “flux capacitor”." and lists no movements.

## Clear the search
Clear all text from the search box.
Verify the catalogue lists "Spur Gears", "Scotch Yoke" and "Geneva Drive" again.

## Filter by category
Click the "Cams" category button above the list.
Verify the catalogue lists only "Cam and Follower (Heart Cam)" and does not list "Spur Gears".

## Open the filtered movement
Click "Cam and Follower (Heart Cam)" in the list.
Verify the details panel heading reads "Cam and Follower (Heart Cam)" and the panel shows the text "Movement #96 · Cams".
