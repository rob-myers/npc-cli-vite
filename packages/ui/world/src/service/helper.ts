export const helper = {
  getGmRoomKey(gmId: number, roomId: number): Geomorph.GmRoomKey {
    return `g${gmId}r${roomId}`;
  },

  getGmRoomId(...input: [Geomorph.GmRoomKey] | [number, number]): Geomorph.GmRoomId {
    if (typeof input[0] === "string") {
      const [, gStr, rStr] = input[0].split(/[gr]/);
      return { grKey: input[0], gmId: Number(gStr), roomId: Number(rStr) };
    } else {
      return { grKey: helper.getGmRoomKey(input[0], input[1]), gmId: input[0], roomId: input[1] };
    }
  },
};

export type Helper = typeof helper;
