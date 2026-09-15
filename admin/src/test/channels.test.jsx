import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChannelForm, { emptyChannel, validate, toPayload, describeParams } from '../components/ChannelForm.jsx';
import { moveItem } from '../lineupUtil.js';

describe('channel form logic', () => {
  it('validates ip multicast and rf', () => {
    expect(Object.keys(validate({ ...emptyChannel(), number: '5', name: 'CNN', ipMode: 'multicast', params: { ip: '239.1.1.1', port: '5000' } }))).toEqual([]);
    const e = validate({ ...emptyChannel(), number: '', name: '', ipMode: 'multicast', params: { ip: 'x', port: '0' } });
    expect(e).toMatchObject({ number: expect.any(String), name: 'Required', ip: expect.any(String), port: expect.any(String) });
    const rf = validate({ number: '7', name: 'RF', type: 'rf', params: { rfBroadcastType: 'terrestrial', frequency: '63000000', programNumber: '1' } });
    expect(rf).toEqual({});
    expect(validate({ number: '7', name: 'RF', type: 'rf', params: { rfBroadcastType: '', frequency: '-1', programNumber: '' } })).toMatchObject({ rfBroadcastType: expect.any(String), frequency: expect.any(String), programNumber: expect.any(String) });
  });
  it('builds payloads per mode and describes params', () => {
    const url = toPayload({ number: '1', name: 'HLS', type: 'ip', enabled: true, ipMode: 'url', params: { url: 'http://x/a.m3u8', mimeType: '' } });
    expect(url.params).toEqual({ url: 'http://x/a.m3u8', mimeType: undefined });
    const mc = toPayload({ number: '2', name: 'MC', type: 'ip', enabled: false, ipMode: 'multicast', params: { ip: '239.1.1.2', port: '5000' } });
    expect(mc).toMatchObject({ number: 2, enabled: false, params: { ipBroadcastType: 'udp', ip: '239.1.1.2', port: 5000 } });
    const rf = toPayload({ number: '3', name: 'RF', type: 'rf', enabled: true, params: { rfBroadcastType: 'satellite_2', frequency: '11000', programNumber: '4', majorNumber: '', satelliteId: '1', polarization: 'vertical' } });
    expect(rf.params).toEqual({ rfBroadcastType: 'satellite_2', frequency: 11000, programNumber: 4, satelliteId: 1, polarization: 'vertical' });
    expect(describeParams({ type: 'ip', params: { ip: '239.1.1.2', port: 5000 } })).toBe('udp://239.1.1.2:5000');
    const ssm = toPayload({ number: '4', name: 'SSM', type: 'ip', enabled: true, ipMode: 'multicast', params: { ip: '239.1.1.4', port: '5000', ipBroadcastType: 'rtp', sourceAddress: '10.0.0.9', videoStreamType: 'HEVC' } });
    expect(ssm.params).toEqual({ ipBroadcastType: 'rtp', ip: '239.1.1.4', port: 5000, sourceAddress: '10.0.0.9', videoStreamType: 'HEVC' });
    const t2 = toPayload({ number: '5', name: 'T2', type: 'rf', enabled: true, params: { rfBroadcastType: 'terrestrial_2', frequency: '490000000', programNumber: '4', plpId: '1', videoStreamType: 'HEVC' } });
    expect(t2.params).toEqual({ rfBroadcastType: 'terrestrial_2', frequency: 490000000, programNumber: 4, plpId: 1, videoStreamType: 'HEVC' });
    expect(validate({ number: '4', name: 'x', type: 'ip', ipMode: 'multicast', params: { ip: '239.1.1.4', port: '5000', sourceAddress: 'bad' } })).toMatchObject({ sourceAddress: expect.any(String) });
    expect(describeParams({ type: 'rf', params: { rfBroadcastType: 'cable', frequency: 57000000, programNumber: 3 } })).toContain('57.000 MHz');
  });
  it('moveItem reorders immutably', () => {
    const a = [1, 2, 3];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem(a, 2, 1)).toEqual([1, 3, 2]);
    expect(moveItem(a, 0, -1)).toBe(a);
  });
  it('form switches fields by type and submits a valid payload', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<ChannelForm channel={emptyChannel()} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Required|0–9999|IPv4/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sports' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'rf' } });
    expect(screen.getByLabelText('Frequency')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('rfBroadcastType'), { target: { value: 'cable' } });
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: '57000000' } });
    fireEvent.change(screen.getByLabelText('Program number'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ number: 12, name: 'Sports', type: 'rf', params: { rfBroadcastType: 'cable', frequency: 57000000, programNumber: 2 } })));
  });
});
