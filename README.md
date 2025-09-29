# TODO
Immediate task: Storage

### General
- get node/link font family, font size and opacity feedback
- hover effects
- mobile: needs to be able to drag nodes when zoomed out
  - expand hitbox when zoomed out
  - just pick the nearest node within a certain distance?

### Sidebar
- add functionality to reset/auto/update buttons
  - should the buttons be for each section instead?
  - feature put on hold for now
- Keys like slash should not do anything if a text input is focused

### Forces
- lots and lots of sliders
- should we store the node positions in local storage?

### Groups
- should forces apply to specific groups?
- popup design needs to be reworked. think about it more

### Labels
- sliders for font size and opacity for nodes and links based on zoom level
- cbs allowing for full theme customisation

### Data (Sidebar)
- think about ways to improve each entry in the dataset list
  - do they really need to be renamable?
  - should each dataset have a download button or leave it all to the storage section?
- Important: Merge needs to be more robust - breaks when you add incremental files without the base file

### Data (Generation)
- improve desc_html on data side
    - add bolding, links, etc
    - images

### Storage
- Bunch of checkboxes for what to act on
  - forces
  - groups
  - labels
  - data
- Bunch of buttons for actions
  - Reset to default button
  - Save to local storage button
  - Load from local storage button
  - Save to file button
  - Load from file button

### Search
- get feedback on general styling
- fuzzy search. do i even need it?
- advanced filters (tags, degree, ...)
- temp highlight search result node

