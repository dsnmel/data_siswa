require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pool Koneksi Database
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Endpoint API untuk menyimpan data siswa dan wali
app.post('/api/siswa', async (req, res) => {
    const { nama_siswa, nisn, kelas, nama_wali, no_hp, pekerjaan } = req.body;

    // Validasi input sederhana
    if (!nama_siswa || !nisn || !kelas || !nama_wali || !no_hp || !pekerjaan) {
        return res.status(400).json({ success: false, message: 'Semua data harus diisi!' });
    }

    // Ambil satu koneksi dari pool untuk keperluan Transaction
    const connection = await pool.getConnection();

    try {
        // 1. Mulai Transaksi
        await connection.beginTransaction();

        // 2. Insert Data Wali
        const queryWali = `INSERT INTO wali (nama_wali, no_hp, pekerjaan) VALUES (?, ?, ?)`;
        const [resultWali] = await connection.execute(queryWali, [nama_wali, no_hp, pekerjaan]);
        
        // Ambil ID wali yang baru saja di-generate oleh MySQL
        const waliId = resultWali.insertId;

        // 3. Insert Data Siswa dengan wali_id sebagai Foreign Key
        const querySiswa = `INSERT INTO siswa (nisn, nama_siswa, kelas, wali_id) VALUES (?, ?, ?, ?)`;
        await connection.execute(querySiswa, [nisn, nama_siswa, kelas, waliId]);

        // 4. Jika semua berhasil, simpan permanen (Commit)
        await connection.commit();

        res.status(201).json({ success: true, message: 'Data siswa dan wali berhasil disimpan!' });

    } catch (error) {
        // Jika ada error (misal: NISN duplikat), batalkan semua operasi di atas (Rollback)
        await connection.rollback();
        console.error('Error saat transaksi:', error);

        // Berikan pesan error yang lebih spesifik jika NISN duplikat
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Gagal! NISN sudah terdaftar.' });
        }

        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    } finally {
        // Kembalikan koneksi ke pool
        connection.release();
    }
});

app.get('/api/siswa', async (req, res) => {
    try {
        // Menggunakan INNER JOIN untuk menggabungkan data berdasarkan wali_id
        const query = `
            SELECT 
                s.nisn, 
                s.nama_siswa, 
                s.kelas, 
                w.nama_wali, 
                w.no_hp, 
                w.pekerjaan 
            FROM siswa s
            INNER JOIN wali w ON s.wali_id = w.id
            ORDER BY s.id DESC
        `;
        
        const [rows] = await pool.query(query);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('Error saat mengambil data:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data dari server.' });
    }
});

// Endpoint untuk mengupdate data siswa dan wali (Inline Edit)
app.put('/api/siswa/:nisn', async (req, res) => {
    const { nisn } = req.params; // Menggunakan NISN lama sebagai kunci utama pencarian
    const { nama_siswa, kelas, nama_wali, no_hp, pekerjaan } = req.body;

    if (!nama_siswa || !kelas || !nama_wali || !no_hp || !pekerjaan) {
        return res.status(400).json({ success: false, message: 'Semua kolom harus diisi!' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Cari wali_id terlebih dahulu berdasarkan NISN siswa yang ingin diedit
        const [siswaRows] = await connection.execute('SELECT wali_id FROM siswa WHERE nisn = ?', [nisn]);
        if (siswaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Data siswa tidak ditemukan.' });
        }
        const waliId = siswaRows[0].wali_id;

        // 2. Update data Wali Murid
        const updateWaliQuery = `UPDATE wali SET nama_wali = ?, no_hp = ?, pekerjaan = ? WHERE id = ?`;
        await connection.execute(updateWaliQuery, [nama_wali, no_hp, pekerjaan, waliId]);

        // 3. Update data Siswa
        const updateSiswaQuery = `UPDATE siswa SET nama_siswa = ?, kelas = ? WHERE nisn = ?`;
        await connection.execute(updateSiswaQuery, [nama_siswa, kelas, nisn]);

        await connection.commit();
        res.status(200).json({ success: true, message: 'Data berhasil diperbarui secara real-time!' });

    } catch (error) {
        await connection.rollback();
        console.error('Error saat melakukan update:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui data di server.' });
    } finally {
        connection.release();
    }
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});