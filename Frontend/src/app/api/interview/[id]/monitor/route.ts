export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { monitorFrame } from '@/lib/faceproj-client';

export async function POST(request: NextRequest) {
  try {
    const { frame } = await request.json();
    if (!frame) {
      return NextResponse.json({ error: 'frame is required' }, { status: 400 });
    }

    const result = await monitorFrame(frame);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Monitor frame error:', error);
    return NextResponse.json({ error: error.message || 'Monitoring failed' }, { status: 500 });
  }
}
