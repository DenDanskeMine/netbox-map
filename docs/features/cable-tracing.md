# Cable Tracing

The plugin provides cable trace visualization on floor plans, allowing you to follow connections from devices through patch panels.

## How It Works

1. Expand a rack on the floor plan sidebar
2. Click the cable icon on any device
3. The trace follows: **Device port** -> **Cable** -> **Patch Panel Front Port** -> **Rear Port** -> **Cable** -> **Next Device**

## Through-Panel Tracing

The trace follows connections through multiple patch panels automatically. For example:

```
Server:eth0 -> Cable -> PP1:Front1 -> PP1:Rear1 -> Cable -> PP2:Front1 -> PP2:Rear1 -> Cable -> Switch:Gig1/0/1
```

## Show on Map

When a traced device exists on the current floor plan, a "Show on Map" button appears. Clicking it zooms and pans to the device's tile on the canvas.

## Drop Tile Tracing

Drop tiles (network wall plates) support port assignments. Assign front and rear ports to a drop tile to enable tracing from the wall plate through the structured cabling to network switches.
